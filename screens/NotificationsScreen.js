import { TouchableWeb } from "../components/TouchableWeb";
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  PanResponder,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, GRADIENTS } from '../constants';
import useWindowDimensions from '../hooks/useWindowDimensions';

const normalizeRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'superadmin' || normalized === 'admins') return 'admin';
  if (normalized === 'nurses') return 'nurse';
  if (normalized === 'users' || normalized === 'customers' || normalized === 'customer') return 'patient';
  return normalized;
};

export default function NotificationsScreen({ navigation }) {
  const { user } = useAuth();
  const { 
    notifications, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification, 
    getRelativeTime 
  } = useNotifications();

  // Filter notifications based on user role
  const userNotifications = notifications.filter(notification => {
    // Show notification if no targetRole specified (global) or if targetRole matches user role
    return !notification.data?.targetRole || normalizeRole(notification.data.targetRole) === normalizeRole(user?.role);
  });

  const handleNotificationPress = async (notification) => {
    // Mark as read when pressed
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    // Handle navigation based on notification type
    const notifType = notification.data?.type;
    const userRole = user?.role;

    // Helper function to navigate back to main app
    const navigateToMainApp = (screen, params = {}) => {
      if (userRole === 'admin') {
        // Navigate back to AdminApp tab navigator, then to specific screen
        navigation.navigate('AdminApp', { screen, params });
      } else if (userRole === 'nurse') {
        // Navigate back to NurseApp tab navigator, then to specific screen
        navigation.navigate('NurseApp', { screen, params });
      } else if (userRole === 'patient') {
        // Navigate back to MainApp tab navigator, then to specific screen
        navigation.navigate('MainApp', { screen, params });
      }
    };

    // Chat/Message notifications
    if (notifType === 'chat' && notification.data?.conversationId) {
      navigateToMainApp('Chat', {
        openConversation: notification.data.conversationId,
        notificationData: notification.data
      });
    } 
    // Appointment notifications (all roles)
    else if (notifType === 'appointment' || notifType === 'appointment_approved' || notifType === 'reminder' || notifType === 'appointment_reminder') {
      if (userRole === 'admin') {
        navigateToMainApp('Dashboard', {
          initialTab: 'pending'
        });
      } else if (userRole === 'nurse') {
        navigateToMainApp('Appointments', {
          initialTab: 'booked'
        });
      } else if (userRole === 'patient') {
        navigateToMainApp('Appointments', {
          initialTab: 'upcoming'
        });
      }
    }
    // Assignment notifications (nurse receives assignment, admin sees responses)
    else if ((notifType === 'assignment_received' || notifType === 'appointment_assigned') && userRole === 'nurse') {
      navigateToMainApp('Appointments', {
        initialTab: 'pending',
        highlightAssignment: notification.data?.assignmentId || notification.data?.appointmentId
      });
    }
    else if ((notifType === 'assignment_accepted' || notifType === 'assignment_declined') && userRole === 'admin') {
      navigateToMainApp('Dashboard', {
        highlightAssignment: notification.data?.assignmentId
      });
    }
    // Shift request notifications (nurse requests, admin approves/denies)
    else if (notifType === 'shift_request' && userRole === 'admin') {
      navigateToMainApp('Dashboard', { 
        initialTab: 'pending',
        highlightShiftRequest: notification.data?.shiftRequestId 
      });
    }
    // Shift approved notifications (nurse receives approval)
    else if (notifType === 'shift_approved' && userRole === 'nurse') {
      navigateToMainApp('Appointments', {
        initialTab: 'approved',
        highlightShiftRequest: notification.data?.shiftRequestId
      });
    }
    // Shift approved/denied notifications (nurse)
    else if (notifType === 'shift_approved' && userRole === 'nurse') {
      navigateToMainApp('Appointments', { 
        initialTab: 'booked',
        highlightShift: notification.data?.shiftRequestId 
      });
    }
    else if (notifType === 'shift_denied' && userRole === 'nurse') {
      navigateToMainApp('Appointments', {
        highlightShift: notification.data?.shiftRequestId
      });
    }
    // Shift started/completed notifications (admin sees nurse shift updates)
    else if (notifType === 'shift_started' && userRole === 'admin') {
      navigateToMainApp('Dashboard', {
        highlightActiveShift: notification.data?.shiftId
      });
    }
    else if (notifType === 'shift_completed' && userRole === 'admin') {
      navigateToMainApp('Dashboard', {
        highlightCompletedShift: notification.data?.shiftId
      });
    }
    // Appointment completed notifications (admin and patient)
    else if (notifType === 'appointment_completed') {
      if (userRole === 'admin') {
        navigateToMainApp('Dashboard', {
          initialTab: 'completed',
          highlightAppointment: notification.data?.appointmentId
        });
      } else if (userRole === 'patient') {
        navigateToMainApp('Appointments', {
          initialTab: 'completed',
          highlightAppointment: notification.data?.appointmentId
        });
      } else if (userRole === 'nurse') {
        navigateToMainApp('Appointments', {
          initialTab: 'completed',
          highlightAppointment: notification.data?.appointmentId
        });
      }
    }
    // Active shift notifications (both admin and nurse)
    else if (notifType === 'active_shift') {
      if (userRole === 'admin') {
        navigateToMainApp('Dashboard', {
          highlightActiveShift: notification.data?.shiftId
        });
      } else if (userRole === 'nurse') {
        navigateToMainApp('Appointments', { 
          initialTab: 'active',
          highlightShift: notification.data?.shiftId
        });
      }
    }
    // Profile edit request/approval notifications
    else if (notifType === 'profile_edit_request' && userRole === 'admin') {
      navigateToMainApp('Dashboard', {
        initialTab: 'profile_edits',
        highlightRequest: notification.data?.requestId
      });
    }
    else if (notifType === 'profile_edit_approved' && userRole === 'nurse') {
      navigateToMainApp('Profile', {
        showApprovedMessage: true
      });
    }
    else if (notifType === 'profile_edit_denied' && userRole === 'nurse') {
      navigateToMainApp('Profile', {
        showDeniedMessage: true,
        denialReason: notification.data?.reason
      });
    }
    // Store Order notifications (patient places, admin manages)
    else if (notifType === 'order_placed' && userRole === 'admin') {
      navigation.navigate('AdminStoreOrders', {
        highlightOrder: notification.data?.orderId
      });
    }
    else if (notifType === 'order_confirmed' && userRole === 'patient') {
      navigation.navigate('PatientStoreOrders', {
        highlightOrder: notification.data?.orderId,
        initialTab: 'pending'
      });
    }
    else if (notifType === 'order_delivered' && userRole === 'patient') {
      navigation.navigate('PatientStoreOrders', {
        highlightOrder: notification.data?.orderId,
        initialTab: 'completed'
      });
    }
    else if (notifType === 'order_cancelled' && userRole === 'patient') {
      navigation.navigate('PatientStoreOrders', {
        highlightOrder: notification.data?.orderId,
        initialTab: 'cancelled'
      });
    }
    // Invoice notifications (all roles)
    else if (notifType === 'invoice_generated') {
      if (userRole === 'admin') {
        navigation.navigate('InvoiceManagement', {
          highlightInvoice: notification.data?.invoiceId
        });
      } else if (userRole === 'patient') {
        navigation.navigate('InvoiceDisplay', {
          invoiceId: notification.data?.invoiceId
        });
      }
    }
    else if (notifType === 'invoice_generated_email_failed' && userRole === 'admin') {
      navigation.navigate('InvoiceManagement', {
        highlightInvoice: notification.data?.invoiceId,
        showEmailError: true
      });
    }
    else if (notifType === 'invoice_generation_failed' && userRole === 'admin') {
      navigation.navigate('InvoiceManagement');
    }
    // Payment/Transaction notifications
    else if (notifType === 'staff_payment') {
      if (userRole === 'admin') {
        navigation.navigate('AdminPaymentsScreen');
      } else if (userRole === 'nurse') {
        navigateToMainApp('Profile', {
          showPaymentHistory: true
        });
      }
    }
    else if (notifType === 'payment_received' && userRole === 'nurse') {
      navigateToMainApp('Profile', {
        showPaymentHistory: true,
        highlightPayment: notification.data?.paymentId
      });
    }
    // Service/System notifications - go to appropriate home screen
    else if (notifType === 'service') {
      if (userRole === 'admin') {
        navigateToMainApp('Dashboard');
      } else if (userRole === 'nurse') {
        navigateToMainApp('Appointments');
      } else if (userRole === 'patient') {
        navigateToMainApp('Home');
      }
    }
    // System/Alert notifications - go to home
    else if (notifType === 'system' || notifType === 'alert') {
      if (userRole === 'admin') {
        navigateToMainApp('Dashboard');
      } else if (userRole === 'nurse') {
        navigateToMainApp('Appointments');
      } else {
        navigateToMainApp('Home');
      }
    }
    // Default - go back or stay (just mark as read)
    else {
      // No specific navigation, notification marked as read
    }
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead();
  };

  const SwipeableNotificationCard = ({ notification }) => {
    const translateX = useRef(new Animated.Value(0)).current;
    const { width: screenWidth } = useWindowDimensions();
    const deleteThreshold = -screenWidth * 0.3; // 30% of screen width

    const panResponder = PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow left swipe (negative dx)
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < deleteThreshold) {
          // Delete notification
          Animated.timing(translateX, {
            toValue: -screenWidth,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            deleteNotification(notification.id);
          });
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    });

    return (
      <View style={styles.swipeContainer}>
        <View style={styles.deleteBackground}>
          <MaterialCommunityIcons name="delete" size={24} color={COLORS.white} />
          <Text style={styles.deleteText}>Delete</Text>
        </View>
        <Animated.View
          style={[
            styles.notificationCardWrapper,
            { transform: [{ translateX }] }
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableWeb
            style={[
              styles.notificationCard,
              !notification.read && styles.unreadCard,
            ]}
            activeOpacity={0.7}
            onPress={() => handleNotificationPress(notification)}
          >
            <View style={styles.notificationContent}>
              <View style={styles.notificationHeader}>
                <Text style={styles.notificationTitle}>{notification.title}</Text>
                {!notification.read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
              <Text style={styles.notificationTime}>
                {getRelativeTime(notification.timestamp)}
              </Text>
            </View>
          </TouchableWeb>
        </Animated.View>
      </View>
    );
  };

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
          <Text style={styles.welcomeText}>Notifications</Text>
          <TouchableWeb style={styles.iconButton} activeOpacity={0.7} onPress={handleMarkAllRead}>
            <MaterialCommunityIcons name="check-all" size={24} color={COLORS.white} />
          </TouchableWeb>
        </View>
      </LinearGradient>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.notificationsList}>
          {userNotifications.length > 0 ? (
            userNotifications.map((notification) => (
              <SwipeableNotificationCard 
                key={notification.id} 
                notification={notification} 
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="bell-off-outline"
                size={80}
                color={COLORS.textLight}
              />
              <Text style={styles.emptyStateTitle}>No Notifications</Text>
              <Text style={styles.emptyStateText}>
                You're all caught up! Check back later for updates.
              </Text>
            </View>
          )}
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
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },
  notificationsList: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  swipeContainer: {
    position: 'relative',
    marginBottom: SPACING.sm,
    marginHorizontal: SPACING.xs,
  },
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.error,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  deleteText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  notificationCardWrapper: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 12,
    alignItems: 'flex-start',
  },
  unreadCard: {
    backgroundColor: COLORS.white,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  notificationTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 1,
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 6,
  },
  notificationMessage: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 4,
    lineHeight: 16,
  },
  notificationTime: {
    fontSize: 10,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl * 2,
    paddingHorizontal: SPACING.xl,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  emptyStateText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
});
