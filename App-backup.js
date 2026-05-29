import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';

import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import TestScreen from './screens/TestScreen';
import SplashScreen from './screens/SplashScreen';
import LoginScreen from './screens/LoginScreen';
import { COLORS } from './constants';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Custom Chat Tab Icon with Badge
function ChatTabIcon({ focused, color, size }) {
  const { getTotalUnreadCount } = useChat();
  const { user } = useAuth();
  
  // Get unread count based on user role
  let userType = 'patient'; // default
  if (user?.role === 'admin') {
    userType = 'admin';
  } else if (user?.role === 'nurse') {
    userType = 'nurse';
  } else if (user?.role === 'patient') {
    userType = 'patient';
  }
  
  const unreadCount = getTotalUnreadCount(userType);
  
  return (
    <View style={{ position: 'relative' }}>
      <MaterialCommunityIcons 
        name={focused ? 'chat' : 'chat-outline'} 
        size={size} 
        color={color} 
      />
      {unreadCount > 0 && (
        <View style={{
          position: 'absolute',
          top: -6,
          right: -8,
          backgroundColor: '#FF4757',
          borderRadius: 10,
          minWidth: 20,
          height: 20,
          justifyContent: 'center',
          alignItems: 'center',
          borderWidth: 2,
          borderColor: COLORS.white,
        }}>
          <Text style={{
            color: COLORS.white,
            fontSize: 11,
            fontFamily: 'Poppins_600SemiBold',
            textAlign: 'center',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
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
                } else if (route.name === 'Chat') {
                  return <ChatTabIcon focused={focused} color={color} size={size} />;
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: COLORS.accent,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 90,
                paddingBottom: 34,
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
            <Tab.Screen name="Book" component={BookScreen} />
            <Tab.Screen name="Chat" component={PatientChatScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

function NurseNavigator() {
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
                } else if (route.name === 'Chat') {
                  return <ChatTabIcon focused={focused} color={color} size={size} />;
                } else if (route.name === 'Profile') {
                  iconName = focused ? 'account-heart' : 'account-heart-outline';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: COLORS.accent,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 90,
                paddingBottom: 34,
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
            <Tab.Screen name="Appointments" component={NurseAppointmentsScreen} />
            <Tab.Screen name="Chat" component={NurseChatScreen} />
            <Tab.Screen name="Profile" component={NurseProfileScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

function AdminDashboardNavigator() {
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
                } else if (route.name === 'Clients') {
                  iconName = focused ? 'account-group' : 'account-group-outline';
                } else if (route.name === 'Staff') {
                  iconName = focused ? 'account-heart' : 'account-heart-outline';
                } else if (route.name === 'Chat') {
                  return <ChatTabIcon focused={focused} color={color} size={24} />;
                } else if (route.name === 'Payments') {
                  iconName = focused ? 'cash-multiple' : 'cash-multiple';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={24} color={color} />;
              },
              tabBarActiveTintColor: COLORS.accent,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 90,
                paddingBottom: 34,
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
            <Tab.Screen name="Clients" component={AdminClientsScreen} />
            <Tab.Screen name="Staff" component={AdminAnalyticsScreen} />
            <Tab.Screen name="Chat" component={AdminChatScreen} />
            <Tab.Screen name="Payments" component={AdminPaymentsScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { user, isLoading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Check if we should show splash screen on app load or after logout
    const checkSplashState = async () => {
      try {
        const shouldShowSplash = await AsyncStorage.getItem('shouldShowSplash');
        if (shouldShowSplash === 'true') {
          setShowSplash(true);
          // Clear the flag
          await AsyncStorage.removeItem('shouldShowSplash');
        } else if (user) {
          // If user is already logged in and no splash flag, skip splash
          setShowSplash(false);
        }
      } catch (error) {
        console.log('Error checking splash state:', error);
      }
    };

    checkSplashState();
  }, [user]);

  useEffect(() => {
    // When user logs out (user becomes null), show splash screen
    if (user === null && !isLoading) {
      const checkLogoutSplash = async () => {
        const shouldShowSplash = await AsyncStorage.getItem('shouldShowSplash');
        if (shouldShowSplash === 'true') {
          setShowSplash(true);
        }
      };
      checkLogoutSplash();
    }
  }, [user, isLoading]);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Check user role for navigation
  const isAdmin = user?.role === 'admin';
  const isNurse = user?.role === 'nurse';

  return (
    <NavigationContainer>
      {user ? (
        isAdmin ? <AdminDashboardNavigator /> : 
        isNurse ? <NurseNavigator /> : 
        <MainTabs />
      ) : <AuthStack />}
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <NotificationProvider>
          {/* <AppointmentProvider> */}
            <ChatProvider>
              {/* <ChatNotificationIntegrator /> */}
              <StatusBar style="light" />
              <AppNavigator />
            </ChatProvider>
          {/* </AppointmentProvider> */}
        </NotificationProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
