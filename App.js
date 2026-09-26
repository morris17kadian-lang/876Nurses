import 'react-native-gesture-handler';

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, LogBox, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Updates from 'expo-updates';
import ErrorBoundary from './components/ErrorBoundary';
import { migrateAsyncStorageCareTo876 } from './utils/migrateAsyncStorageCareTo876';
import { COLORS, ENABLE_DEBUG_LOGS } from './constants';

const STARTUP_TIMEOUT_MS = 4000;

// Suppress Expo notifications warning in Expo Go (SDK 53+)
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'WARN  expo-notifications',
  'WARN  `expo-notifications` functionality is not fully supported',
  'provided by expo-notifications was removed from Expo Go',
  'Use a development build instead of Expo Go',
  '@firebase/firestore: Firestore',
  'Error using user provided cache',
  'Offline persistence has been disabled',
  'WARN  [expo-av]: Expo AV has been deprecated',
]);

if (!ENABLE_DEBUG_LOGS) {
  const noop = () => {};
  // Keep warn/error so real problems still surface.
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}

// Import the full original app - now safe with dimension fixes
import AppOriginal from './App-original';

/**
 * SAFE App Entry Point 
 * Direct loading of the 876Nurses app with all features!
 */
export default function App() {
  const [storageReady, setStorageReady] = useState(false);
  const [startupMessage, setStartupMessage] = useState('Preparing 876Nurses...');
  const [startupError, setStartupError] = useState('');

  // Eagerly apply any newer published OTA update on this same launch, instead of
  // relying on expo-updates' default behavior of only applying a downloaded update
  // on the NEXT cold launch. Without this, every fix requires force-quitting the
  // app twice before it's visible. Bounded by its own timeout so a slow/offline
  // network never blocks startup — the app just continues on the cached bundle.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let cancelled = false;

    const applyLatestUpdate = async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (cancelled || !result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        await Updates.reloadAsync();
      } catch (error) {
        console.error('OTA update check failed:', error);
      }
    };

    const timeout = new Promise((resolve) => setTimeout(resolve, 3500));
    Promise.race([applyLatestUpdate(), timeout]);

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startupTimeout = setTimeout(() => {
      if (!cancelled) {
        setStartupMessage('Finishing app startup...');
        setStorageReady(true);
      }
    }, STARTUP_TIMEOUT_MS);

    (async () => {
      try {
        await migrateAsyncStorageCareTo876();
      } catch (error) {
        console.error('Startup storage migration failed:', error);
        if (!cancelled) {
          setStartupError('Startup storage migration failed. Continuing...');
          setStartupMessage('Starting app...');
        }
      } finally {
        clearTimeout(startupTimeout);
        if (!cancelled) setStorageReady(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(startupTimeout);
    };
  }, []);

  if (!storageReady) {
    return (
      <View style={styles.startupContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.startupText}>{startupMessage}</Text>
        {!!startupError && <Text style={styles.startupSubtext}>{startupError}</Text>}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AppOriginal />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  startupContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
  },
  startupText: {
    marginTop: 16,
    color: COLORS.text,
    fontSize: 16,
    textAlign: 'center',
  },
  startupSubtext: {
    marginTop: 8,
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});

