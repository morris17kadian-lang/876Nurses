import TouchableWeb from "../components/TouchableWeb";
import React, { useEffect, useRef, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Animated, 
  Image, 
  TextInput, 
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Modal,
  FlatList
} from 'react-native';
import useWindowDimensions from '../hooks/useWindowDimensions';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GRADIENTS, COLORS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import FirebaseService from '../services/FirebaseService';
import LegalModal from '../components/LegalModal';


// import { seedDefaultChatUsers } from '../utils/chatSeedData';


export default function SplashScreen({ onFinish, onContinueAsGuest }) {
  // Get screen dimensions
  const { width, height } = useWindowDimensions();
  
  // Authentication state
  const [showAuthForms, setShowAuthForms] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [legalVisible, setLegalVisible] = useState(false);
  const [legalDoc, setLegalDoc] = useState('legal');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotPasswordStep, setForgotPasswordStep] = useState('email'); // 'email' or 'sent'
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');
  const [sentToEmail, setSentToEmail] = useState('');

  // Email verification (6-digit code) modal
  const [showVerifyEmail, setShowVerifyEmail] = useState(false);
  const [verifyEmailAddress, setVerifyEmailAddress] = useState('');
  const VERIFICATION_CODE_LENGTH = 6;
  const DEFAULT_VERIFY_EMAIL_RESEND_SECONDS = 60;
  const verificationCodeInputRefs = useRef([]);
  const verifyEmailResendIntervalRef = useRef(null);
  const [verificationCodeDigits, setVerificationCodeDigits] = useState(() =>
    Array(VERIFICATION_CODE_LENGTH).fill('')
  );
  const [verifyEmailLoading, setVerifyEmailLoading] = useState(false);
  const [verifyEmailMessage, setVerifyEmailMessage] = useState('');
  const [verifyEmailResendSecondsLeft, setVerifyEmailResendSecondsLeft] = useState(0);

  const {
    login,
    signup,
    resetPassword,
    requestEmailVerificationCode,
    verifyEmailVerificationCode,
  } = useAuth();
  
  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current; // Start invisible for entrance animation
  const scaleAnim = useRef(new Animated.Value(0.2)).current; // Start small for entrance animation
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const authFormsOpacity = useRef(new Animated.Value(0)).current;
  const authFormsTranslateY = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    // Seed default chat users (e.g., ADMIN001/Nurse Bernard) into AsyncStorage
    // seedDefaultChatUsers();

    // Load saved credentials if remember me was checked
    loadSavedCredentials();
    

    
    // Keyboard event listeners
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );
    
    // Step 1: Logo entrance animation (fade in and scale up)
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Step 2: Wait to show the logo, then move to login position
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 0.6, // Scale down for login page
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: Platform.OS === 'android' ? -height * 0.42 : -height * 0.46,            duration: 800,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Step 3: Show auth forms
          setShowAuthForms(true);
          Animated.parallel([
            Animated.timing(authFormsOpacity, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(authFormsTranslateY, {
              toValue: 0,
              duration: 800,
              useNativeDriver: true,
            }),
          ]).start();
        });
      }, 800); // Show full logo for 0.8 seconds (reduced from 1.3)
    });

    // Cleanup keyboard listeners
    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  useEffect(() => {
    // Cleanup any running countdown when the modal closes/unmounts.
    if (showVerifyEmail) {
      return;
    }

    if (verifyEmailResendIntervalRef.current) {
      clearInterval(verifyEmailResendIntervalRef.current);
      verifyEmailResendIntervalRef.current = null;
    }
  }, [showVerifyEmail]);

  useEffect(() => {
    if (!showVerifyEmail) {
      return;
    }

    const timeout = setTimeout(() => {
      const firstEmptyIndex = verificationCodeDigits.findIndex((d) => !d);
      const indexToFocus =
        firstEmptyIndex === -1 ? VERIFICATION_CODE_LENGTH - 1 : firstEmptyIndex;
      verificationCodeInputRefs.current[indexToFocus]?.focus?.();
    }, 250);

    return () => clearTimeout(timeout);
  }, [showVerifyEmail]);

  const loadSavedCredentials = async () => {
    try {
      const savedCredentials = await AsyncStorage.getItem('savedCredentials');
      if (savedCredentials) {
        const { username, password, rememberMe } = JSON.parse(savedCredentials);
        setUsername(username);
        setPassword(password);
        setRememberMe(rememberMe);
      }
    } catch (error) {
      // Error loading saved credentials
    }
  };

  const saveCredentials = async (username, password) => {
    try {
      const credentials = {
        username,
        password,
        rememberMe: true
      };
      await AsyncStorage.setItem('savedCredentials', JSON.stringify(credentials));
    } catch (error) {
      // Error saving credentials
    }
  };

  const clearSavedCredentials = async () => {
    try {
      await AsyncStorage.removeItem('savedCredentials');
    } catch (error) {
      // Error clearing saved credentials
    }
  };



  const handleRememberMeToggle = async () => {
    const newRememberMe = !rememberMe;
    setRememberMe(newRememberMe);
    
    // If unchecking remember me, clear saved credentials
    if (!newRememberMe) {
      await clearSavedCredentials();
    }
  };

  const handleToggleAuth = (isLoginMode) => {
    setIsLogin(isLoginMode);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setForgotPasswordMessage('');
  };

  const handleLogin = async () => {
    const loginIdentifier = username.trim();

    if (!loginIdentifier) {
      Alert.alert('Error', 'Please enter your username or email');
      return;
    }

    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    setIsLoading(true);
    try {
      const result = await login(loginIdentifier, password);

      if (result?.success) {
        if (rememberMe) {
          await saveCredentials(loginIdentifier, password);
        } else {
          await clearSavedCredentials();
        }

        // Dismiss the SplashScreen once authenticated.
        if (typeof onFinish === 'function') {
          onFinish();
        }
      } else {
        if (result?.needsEmailVerification) {
          const verificationEmail = (result?.verificationEmail || '').toString().trim().toLowerCase();

          Alert.alert(
            'Verify Your Email',
            verificationEmail
              ? `We sent a 6-digit verification code to ${verificationEmail}. Enter it to verify your account before signing in.`
              : 'We sent a 6-digit verification code to your email. Enter it to verify your account before signing in.',
            [
              {
                text: 'Enter Code',
                onPress: () => openVerifyEmailModal({ knownEmail: verificationEmail || undefined, identifierOverride: loginIdentifier }),
              },
              {
                text: 'Resend Code',
                onPress: async () => {
                  const resolvedEmail = verificationEmail || (await resolveAccountEmail(loginIdentifier));
                  if (!resolvedEmail) {
                    return;
                  }

                  const sendResult = await requestEmailVerificationCode(resolvedEmail);
                  if (sendResult?.success) {
                    if (sendResult?.throttled) {
                      const retry = sendResult?.retryAfterSeconds
                        ? ` Please wait ${sendResult.retryAfterSeconds}s and try again.`
                        : '';
                      Alert.alert('Please Wait', `A code was recently sent.${retry}`);
                    } else {
                      Alert.alert('Code Sent', 'Check your inbox for your verification code.');
                    }
                  } else {
                    Alert.alert('Error', sendResult?.error || 'Unable to send verification code. Please try again.');
                  }
                },
              },
              { text: 'Cancel', style: 'cancel' },
            ]
          );
          return;
        }

        Alert.alert('Sign In Failed', result?.error || 'Unable to sign in. Please try again.');
      }
    } catch (error) {
      console.error('Login handler error:', error);
      Alert.alert('Error', 'Unable to sign in right now. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async () => {
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setIsLoading(true);
    const result = await signup(
      signupUsername.trim(),
      email.trim(),
      password,
      phone.trim(),
      address.trim()
    );
    setIsLoading(false);

    if (!result.success) {
      if (result?.errorCode === 'email-already-registered') {
        Alert.alert(
          'Account Already Exists',
          'An account with this email already exists. Would you like to reset your password?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Forgot Password',
              onPress: () => {
                handleToggleAuth(true);
                handleForgotPasswordPress(email.trim());
              },
            },
            {
              text: 'Sign In',
              onPress: () => {
                handleToggleAuth(true);
                setUsername(email.trim());
              },
            },
          ]
        );
        return;
      }

      if (result?.errorCode === 'phone-already-registered') {
        Alert.alert(
          'Phone Number Already Used',
          'An account with this phone number already exists. Would you like to reset your password?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Forgot Password',
              onPress: () => {
                handleToggleAuth(true);
                handleForgotPasswordPress(phone.trim());
              },
            },
            {
              text: 'Sign In',
              onPress: () => {
                handleToggleAuth(true);
              },
            },
          ]
        );
        return;
      }

      Alert.alert('Signup Failed', result.error);
    } else {
      // Account is created, but email verification is required before sign-in.
      const createdUsername = signupUsername.trim();
      const createdEmail = (result?.verificationEmail || email).toString().trim().toLowerCase();

      // Reset signup form and switch back to login mode.
      setSignupUsername('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setPhone('');
      setAddress('');
      setIsLogin(true);
      // Prefill the login field with the username they just registered.
      setUsername(createdUsername);

      // Open the in-app verification modal directly (no extra "OK" button).
      openVerifyEmailModal({ knownEmail: createdEmail || undefined });
    }
  };

  const openLegal = (docKey) => {
    setLegalDoc(docKey);
    setLegalVisible(true);
  };

  const resolveAccountEmail = async (identifierOverride) => {
    const overrideValue = typeof identifierOverride === 'string' ? identifierOverride : null;
    const loginInput = (overrideValue ?? username).trim();

    if (!loginInput) {
      Alert.alert('Account Required', 'Enter your username, email, or phone number in the login field first.');
      return null;
    }

    try {
      if (loginInput.includes('@')) {
        // Avoid blocking password resets on Firestore lookups (and avoid account enumeration).
        // If the user entered an email, proceed with the normalized email.
        return loginInput.trim().toLowerCase();
      }

      const digitsCount = (loginInput.match(/\d/g) || []).length;
      const looksLikePhone = /^[0-9+()\s-]{7,}$/.test(loginInput) && digitsCount >= 7;
      if (looksLikePhone) {
        const phoneLookup = await FirebaseService.getUserByPhone(loginInput);
        const resolvedEmail = (phoneLookup?.user?.email || phoneLookup?.user?.contactEmail || '').toString().trim();

        if (phoneLookup?.success && resolvedEmail) {
          // Helpful: populate the login field with the resolved email for the next sign-in.
          setUsername(resolvedEmail);
          return resolvedEmail.toLowerCase();
        }

        Alert.alert('Account Not Found', 'We could not find an email associated with that phone number.');
        return null;
      }

      // Do not pre-normalize here. FirebaseService.getUserByUsername already handles
      // uppercase staff codes and fallback casing (e.g., older docs with mixed-case usernames).
      const lookup = await FirebaseService.getUserByUsername(loginInput);
      if (lookup?.success && lookup.user?.email) {
        return lookup.user.email.trim();
      }

      Alert.alert('Account Not Found', 'We could not find an email associated with that username or staff code.');
      return null;
    } catch (error) {
      console.error('Error resolving reset email:', error);
      Alert.alert('Error', 'Unable to confirm your account email. Please try again.');
      return null;
    }
  };

  const handleForgotPasswordPress = async (identifierOverride) => {
    setForgotPasswordMessage('');
    setForgotPasswordStep('email');
    setSentToEmail('');
    setForgotEmail('');

    setForgotPasswordLoading(true);
    const resolvedEmail = await resolveAccountEmail(identifierOverride);
    setForgotPasswordLoading(false);

    if (!resolvedEmail) {
      return;
    }

    setForgotEmail(resolvedEmail);
    setShowForgotPassword(true);
  };

  const handleForgotPasswordRequest = async () => {
    if (!forgotEmail.trim()) {
      Alert.alert('Error', 'We could not confirm your registered email. Close this window and try again.');
      return;
    }

    setForgotPasswordLoading(true);
    setForgotPasswordMessage('');
    try {
      const normalizedEmail = forgotEmail.trim().toLowerCase();
      const result = await resetPassword(normalizedEmail);

      if (result?.success) {
        setForgotPasswordStep('sent');
        setSentToEmail(normalizedEmail);
        setForgotPasswordMessage('Reset link sent. Check your inbox.');
      } else {
        const errorMessage = result?.error || 'Error resetting password';
        setForgotPasswordMessage(`Error: ${errorMessage}`);
        Alert.alert('Error', errorMessage);
      }
    } catch (error) {
      console.error('Forgot password request error:', error);
      setForgotPasswordMessage('Error sending reset link. Please try again.');
      Alert.alert('Error', 'Unable to send reset link. Please try again.');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const handleCloseForgotPassword = () => {
    setShowForgotPassword(false);
    setForgotEmail('');
    setForgotPasswordStep('email');
    setForgotPasswordMessage('');
    setSentToEmail('');
  };

  const handleCloseVerifyEmail = () => {
    setShowVerifyEmail(false);
    setVerifyEmailAddress('');
    setVerificationCodeDigits(Array(VERIFICATION_CODE_LENGTH).fill(''));
    setVerifyEmailMessage('');
    setVerifyEmailLoading(false);
    setVerifyEmailResendSecondsLeft(0);

    if (verifyEmailResendIntervalRef.current) {
      clearInterval(verifyEmailResendIntervalRef.current);
      verifyEmailResendIntervalRef.current = null;
    }
  };

  const openVerifyEmailModal = async ({ identifierOverride, knownEmail } = {}) => {
    setVerifyEmailMessage('');
    setVerificationCodeDigits(Array(VERIFICATION_CODE_LENGTH).fill(''));
    setVerifyEmailResendSecondsLeft(0);

    if (verifyEmailResendIntervalRef.current) {
      clearInterval(verifyEmailResendIntervalRef.current);
      verifyEmailResendIntervalRef.current = null;
    }

    setVerifyEmailLoading(true);
    const resolvedEmail = knownEmail
      ? String(knownEmail).trim().toLowerCase()
      : await resolveAccountEmail(identifierOverride);
    setVerifyEmailLoading(false);

    if (!resolvedEmail) {
      return;
    }

    setVerifyEmailAddress(resolvedEmail);
    setShowVerifyEmail(true);

    // Best-effort: (re)send a code when opening.
    setVerifyEmailLoading(true);
    const sendResult = await requestEmailVerificationCode(resolvedEmail);
    setVerifyEmailLoading(false);

    if (sendResult?.success) {
      if (sendResult?.alreadyVerified) {
        setVerifyEmailMessage('This email is already verified. You can sign in.');
        setVerifyEmailResendSecondsLeft(0);
      } else if (sendResult?.throttled) {
        const retry = sendResult?.retryAfterSeconds
          ? ` Please wait ${sendResult.retryAfterSeconds}s and try again.`
          : '';
        setVerifyEmailMessage(`A code was recently sent.${retry}`);

        const retryAfterSeconds = Math.max(0, Math.ceil(Number(sendResult?.retryAfterSeconds || 0)));
        if (retryAfterSeconds > 0) {
          setVerifyEmailResendSecondsLeft(retryAfterSeconds);
          verifyEmailResendIntervalRef.current = setInterval(() => {
            setVerifyEmailResendSecondsLeft((current) => {
              if (current <= 1) {
                if (verifyEmailResendIntervalRef.current) {
                  clearInterval(verifyEmailResendIntervalRef.current);
                  verifyEmailResendIntervalRef.current = null;
                }
                return 0;
              }
              return current - 1;
            });
          }, 1000);
        }
      } else {
        setVerifyEmailMessage('Verification code sent. Check your inbox.');

        // Match backend default throttle window; if backend throttles longer,
        // we will still respect the server response (throttled + retryAfterSeconds).
        setVerifyEmailResendSecondsLeft(DEFAULT_VERIFY_EMAIL_RESEND_SECONDS);
        verifyEmailResendIntervalRef.current = setInterval(() => {
          setVerifyEmailResendSecondsLeft((current) => {
            if (current <= 1) {
              if (verifyEmailResendIntervalRef.current) {
                clearInterval(verifyEmailResendIntervalRef.current);
                verifyEmailResendIntervalRef.current = null;
              }
              return 0;
            }
            return current - 1;
          });
        }, 1000);
      }
    } else {
      setVerifyEmailMessage(sendResult?.error || 'Unable to send verification code. Please try again.');
    }
  };

  const handleVerificationDigitChange = (index, text) => {
    const sanitized = String(text || '').replace(/\D/g, '');

    if (!sanitized) {
      setVerificationCodeDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    const digits = sanitized.split('');
    setVerificationCodeDigits((prev) => {
      const next = [...prev];
      for (let offset = 0; offset < digits.length; offset += 1) {
        const targetIndex = index + offset;
        if (targetIndex >= VERIFICATION_CODE_LENGTH) break;
        next[targetIndex] = digits[offset];
      }
      return next;
    });

    const nextIndex = index + digits.length;
    if (nextIndex < VERIFICATION_CODE_LENGTH) {
      verificationCodeInputRefs.current[nextIndex]?.focus?.();
    } else {
      verificationCodeInputRefs.current[VERIFICATION_CODE_LENGTH - 1]?.blur?.();
    }
  };

  const handleVerificationDigitKeyPress = (index, event) => {
    if (event?.nativeEvent?.key !== 'Backspace') {
      return;
    }

    // If current digit is empty, move back and clear the previous digit.
    if (!verificationCodeDigits[index] && index > 0) {
      verificationCodeInputRefs.current[index - 1]?.focus?.();
      setVerificationCodeDigits((prev) => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
  };

  const handleResendVerificationCode = async () => {
    if (!verifyEmailAddress) {
      Alert.alert('Error', 'Missing email address');
      return;
    }

    if (verifyEmailResendSecondsLeft > 0) {
      return;
    }

    setVerifyEmailLoading(true);
    setVerifyEmailMessage('');
    const sendResult = await requestEmailVerificationCode(verifyEmailAddress);
    setVerifyEmailLoading(false);

    if (sendResult?.success) {
      if (sendResult?.throttled) {
        const retry = sendResult?.retryAfterSeconds
          ? ` Please wait ${sendResult.retryAfterSeconds}s and try again.`
          : '';
        setVerifyEmailMessage(`A code was recently sent.${retry}`);

        const retryAfterSeconds = Math.max(0, Math.ceil(Number(sendResult?.retryAfterSeconds || 0)));
        if (retryAfterSeconds > 0) {
          if (verifyEmailResendIntervalRef.current) {
            clearInterval(verifyEmailResendIntervalRef.current);
            verifyEmailResendIntervalRef.current = null;
          }

          setVerifyEmailResendSecondsLeft(retryAfterSeconds);
          verifyEmailResendIntervalRef.current = setInterval(() => {
            setVerifyEmailResendSecondsLeft((current) => {
              if (current <= 1) {
                if (verifyEmailResendIntervalRef.current) {
                  clearInterval(verifyEmailResendIntervalRef.current);
                  verifyEmailResendIntervalRef.current = null;
                }
                return 0;
              }
              return current - 1;
            });
          }, 1000);
        }
      } else {
        setVerifyEmailMessage('Verification code sent. Check your inbox.');

        if (verifyEmailResendIntervalRef.current) {
          clearInterval(verifyEmailResendIntervalRef.current);
          verifyEmailResendIntervalRef.current = null;
        }

        setVerifyEmailResendSecondsLeft(DEFAULT_VERIFY_EMAIL_RESEND_SECONDS);
        verifyEmailResendIntervalRef.current = setInterval(() => {
          setVerifyEmailResendSecondsLeft((current) => {
            if (current <= 1) {
              if (verifyEmailResendIntervalRef.current) {
                clearInterval(verifyEmailResendIntervalRef.current);
                verifyEmailResendIntervalRef.current = null;
              }
              return 0;
            }
            return current - 1;
          });
        }, 1000);
      }
    } else {
      const errorMessage = sendResult?.error || 'Unable to send verification code. Please try again.';
      setVerifyEmailMessage(errorMessage);
      Alert.alert('Error', errorMessage);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!verifyEmailAddress) {
      Alert.alert('Error', 'Missing email address');
      return;
    }

    const code = verificationCodeDigits.join('');
    if (code.length !== VERIFICATION_CODE_LENGTH) {
      Alert.alert('Error', 'Please enter the 6-digit code');
      return;
    }

    setVerifyEmailLoading(true);
    setVerifyEmailMessage('');
    const verifyResult = await verifyEmailVerificationCode(verifyEmailAddress, code);
    setVerifyEmailLoading(false);

    if (verifyResult?.success) {
      handleCloseVerifyEmail();
      Alert.alert('Email Verified', 'Your email has been verified. You can now sign in.');
      return;
    }

    const errorMessage = verifyResult?.error || 'Invalid code. Please try again.';
    setVerifyEmailMessage(errorMessage);
  };

  const formatVerifyEmailResendCountdown = (totalSeconds) => {
    const clamped = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <LinearGradient
      colors={GRADIENTS.splash}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      {/* Fixed Logo */}
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [
              { scale: scaleAnim },
              { translateY: translateYAnim },
            ],
            // Dynamic positioning based on auth forms visibility and type
            // Keep layout consistent before and after the transition so there is no jump
            // Push logo up when keyboard is visible on sign in
            top: !isLogin 
              ? (Platform.OS === 'ios' ? '19%' : '18%') 
              : (isKeyboardVisible 
                  ? (Platform.OS === 'ios' ? '20%' : '17%')
                  : (Platform.OS === 'ios' ? '37%' : '33%')),
            marginTop: 0,
          },
        ]}
      >
        <Image
          source={require('../assets/Images/Nurses-logo.png')}
          style={[
            styles.logo,
            {
              // Safe inline dimensions
              width: width * 0.3,
              height: height * 0.3,
            }
          ]}
          resizeMode="contain"
          onError={(error) => {}}
          onLoad={() => {}} // Logo image loaded
        />
      </Animated.View>

      {/* Fixed Authentication Forms Container */}
      {showAuthForms && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <Animated.View
            style={[
              styles.authContainer,
              {
                opacity: authFormsOpacity,
                transform: [{ translateY: authFormsTranslateY }],
              }
            ]}
          >
            <View style={styles.fixedAuthBox}>
              <ScrollView 
                contentContainerStyle={[
                  styles.scrollContainer,
                  isKeyboardVisible && styles.scrollContainerKeyboard,
                  !isLogin && styles.scrollContainerSignup
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={true}
                scrollEnabled={isKeyboardVisible || !isLogin}
              >
                <View style={[
                  styles.authContent,
                  !isLogin && styles.authContentExpanded,
                  isKeyboardVisible && styles.authContentKeyboard
                ]}>
          {/* Toggle Buttons */}
          <View style={styles.toggleContainer}>
            <TouchableWeb
              style={styles.toggleButton}
              onPress={() => handleToggleAuth(true)}
            >
              {isLogin ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.activeToggleGradient}
                >
                  <Text style={styles.activeToggleText}>Sign In</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.toggleText}>Sign In</Text>
              )}
            </TouchableWeb>
            <TouchableWeb
              style={styles.toggleButton}
              onPress={() => handleToggleAuth(false)}
            >
              {!isLogin ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.activeToggleGradient}
                >
                  <Text style={styles.activeToggleText}>Sign Up</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.toggleText}>Sign Up</Text>
              )}
            </TouchableWeb>
          </View>

          {/* Form Fields */}
          <View style={styles.formContainer}>
            {!isLogin && (
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons name="account" size={20} color="rgba(0, 0, 0, 0.7)" />
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    value={signupUsername}
                    onChangeText={setSignupUsername}
                    placeholderTextColor="rgba(0, 0, 0, 0.5)"
                  />
                </View>
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientLine}
                />
              </View>
            )}

            <View style={styles.inputWrapper}>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons 
                  name={isLogin ? "account" : "email"} 
                  size={20} 
                  color="rgba(0, 0, 0, 0.7)" 
                />
                <TextInput
                  style={styles.input}
                  placeholder={isLogin ? "Username" : "Email"}
                  value={isLogin ? username : email}
                  onChangeText={isLogin ? setUsername : setEmail}
                  placeholderTextColor="rgba(0, 0, 0, 0.5)"
                  autoCapitalize="none"
                  keyboardType={!isLogin ? "email-address" : "default"}
                />
              </View>
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.inputGradientLine}
              />
            </View>

            {!isLogin && (
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons name="phone" size={20} color="rgba(0, 0, 0, 0.7)" />
                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholderTextColor="rgba(0, 0, 0, 0.5)"
                    keyboardType="phone-pad"
                  />
                </View>
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientLine}
                />
              </View>
            )}

            {!isLogin && (
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons name="home" size={20} color="rgba(0, 0, 0, 0.7)" />
                  <TextInput
                    style={styles.input}
                    placeholder="Address"
                    value={address}
                    onChangeText={setAddress}
                    placeholderTextColor="rgba(0, 0, 0, 0.5)"
                  />
                </View>
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientLine}
                />
              </View>
            )}

            <View style={styles.inputWrapper}>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="lock" size={20} color="rgba(0, 0, 0, 0.7)" />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholderTextColor="rgba(0, 0, 0, 0.5)"
                  secureTextEntry={!showPassword}
                />
                <TouchableWeb
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color="#4A90E2"
                  />
                </TouchableWeb>
              </View>
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.inputGradientLine}
              />
            </View>

            {!isLogin && (
              <View style={styles.inputWrapper}>
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons name="lock-check" size={20} color="rgba(0, 0, 0, 0.7)" />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholderTextColor="rgba(0, 0, 0, 0.5)"
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableWeb
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeIcon}
                  >
                    <MaterialCommunityIcons
                      name={showConfirmPassword ? 'eye-off' : 'eye'}
                      size={20}
                      color="#4A90E2"
                    />
                  </TouchableWeb>
                </View>
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientLine}
                />
              </View>
            )}
          </View>

          {/* Forgot Password - Only show for login */}
          {isLogin && (
            <View style={styles.rememberMeContainer}>
              <TouchableWeb
                style={styles.rememberMeButton}
                onPress={handleRememberMeToggle}
              >
                <MaterialCommunityIcons
                  name={rememberMe ? "checkbox-marked" : "checkbox-blank-outline"}
                  size={20}
                  color="rgba(51, 51, 51, 0.8)"
                />
                <Text style={styles.rememberMeText}>Remember Me</Text>
              </TouchableWeb>
              <TouchableWeb style={styles.forgotPassword} onPress={handleForgotPasswordPress}>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableWeb>
            </View>
          )}

          {/* Terms - Only show for signup */}
          {!isLogin && (
            <>
              <Text style={styles.termsText}>
                By signing up, you agree to our{' '}
                <Text style={styles.termsLink} onPress={() => openLegal('legal')}>
                  Terms of Service & Privacy Policy
                </Text>
              </Text>
            </>
          )}

          {/* Submit Button */}
          <TouchableWeb
            style={[styles.submitButton, isLoading && styles.disabledButton]}
            onPress={!isLogin ? handleSignup : handleLogin}
            disabled={isLoading}
          >
            <LinearGradient
              colors={isLoading ? ['#CCCCCC', '#CCCCCC'] : GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.submitButtonGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {!isLogin ? 'Sign Up' : 'Sign In'}
                </Text>
              )}
            </LinearGradient>
          </TouchableWeb>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>



          {/* Register/Login Link */}
          <View style={styles.linkContainer}>
            <Text style={styles.linkText}>
              {isLogin ? "Don't have an account? " : "Already have an account? "}
            </Text>
            <TouchableWeb onPress={() => handleToggleAuth(!isLogin)}>
              <Text style={styles.linkButton}>
                {isLogin ? "Register" : "Sign In"}
              </Text>
            </TouchableWeb>
          </View>

          {typeof onContinueAsGuest === 'function' && (
            <TouchableWeb
              style={styles.guestAccessButton}
              onPress={onContinueAsGuest}
              activeOpacity={0.8}
            >
              <Text style={styles.guestAccessButtonText}>Continue Without an Account</Text>
            </TouchableWeb>
          )}
                </View>
              </ScrollView>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      )}

      {/* Forgot Password Modal */}
      <Modal
        visible={showForgotPassword}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseForgotPassword}
      >
        <View style={styles.forgotPasswordOverlay}>
          <View style={styles.forgotPasswordContainer}>
            {/* Header */}
            <View style={styles.forgotPasswordHeader}>
              <Text style={styles.forgotPasswordTitle}>Reset Password</Text>
              <TouchableWeb
                onPress={handleCloseForgotPassword}
                style={styles.forgotPasswordCloseButton}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={24}
                  color={COLORS.text}
                />
              </TouchableWeb>
            </View>

            <ScrollView style={styles.forgotPasswordContent} showsVerticalScrollIndicator={false}>
              {forgotPasswordStep === 'email' ? (
                <>
                  <Text style={styles.forgotPasswordDescription}>
                    We'll send a reset link to the email you used when signing up.
                  </Text>

                  <View style={styles.forgotPasswordForm}>
                    <Text style={styles.inputLabel}>Registered Email</Text>
                    <View style={styles.forgotPasswordLockedInput}>
                      <MaterialCommunityIcons name="email-lock" size={20} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                      <Text style={styles.lockedEmailText}>{forgotEmail}</Text>
                    </View>
                    <Text style={styles.lockedEmailHint}>
                      Need to use a different account? Close this window and update the login field (email/username/phone) first.
                    </Text>

                    {forgotPasswordMessage ? (
                      <Text style={[styles.forgotPasswordMessage, { color: forgotPasswordMessage.includes('Error') ? COLORS.error : COLORS.success }]}>
                        {forgotPasswordMessage}
                      </Text>
                    ) : null}

                    <TouchableWeb
                      style={[styles.submitButton, styles.forgotPasswordButton, forgotPasswordLoading && styles.disabledButton]}
                      onPress={handleForgotPasswordRequest}
                      disabled={forgotPasswordLoading}
                    >
                      <LinearGradient
                        colors={forgotPasswordLoading ? ['#CCCCCC', '#CCCCCC'] : GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.submitButtonGradient}
                      >
                        {forgotPasswordLoading ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.submitButtonText}>Send Reset Link</Text>
                        )}
                      </LinearGradient>
                    </TouchableWeb>
                  </View>
                </>
              ) : forgotPasswordStep === 'sent' ? (
                <>
                  <View style={styles.successIcon}>
                    <MaterialCommunityIcons
                      name="email-check"
                      size={48}
                      color="#51cf66"
                    />
                  </View>
                  <Text style={styles.forgotPasswordDescription}>
                    A password reset link has been sent to:
                  </Text>
                  <Text style={styles.emailHighlight}>{sentToEmail}</Text>
                  <Text style={styles.forgotPasswordDescription}>
                    Open the email and tap the reset link to choose a new password in your browser. After resetting, return here and sign in with your new password.
                  </Text>

                  <View style={styles.forgotPasswordForm}>
                    <TouchableWeb
                      style={[styles.submitButton, styles.forgotPasswordButton, forgotPasswordLoading && styles.disabledButton]}
                      onPress={handleForgotPasswordRequest}
                      disabled={forgotPasswordLoading}
                    >
                      <LinearGradient
                        colors={forgotPasswordLoading ? ['#CCCCCC', '#CCCCCC'] : GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.submitButtonGradient}
                      >
                        {forgotPasswordLoading ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.submitButtonText}>Resend Reset Link</Text>
                        )}
                      </LinearGradient>
                    </TouchableWeb>

                    <TouchableWeb
                      style={styles.backToEmailButton}
                      onPress={handleCloseForgotPassword}
                    >
                      <Text style={styles.backToEmailButtonText}>Close</Text>
                    </TouchableWeb>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Verify Email Modal */}
      <Modal
        visible={showVerifyEmail}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseVerifyEmail}
      >
        <View style={styles.forgotPasswordOverlay}>
          <View style={styles.forgotPasswordContainer}>
            {/* Header */}
            <View style={styles.forgotPasswordHeader}>
              <Text style={styles.forgotPasswordTitle}>Verify Email</Text>
              <TouchableWeb
                onPress={handleCloseVerifyEmail}
                style={styles.forgotPasswordCloseButton}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={24}
                  color={COLORS.text}
                />
              </TouchableWeb>
            </View>

            <ScrollView style={styles.forgotPasswordContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.forgotPasswordDescription}>
                Enter the 6-digit code we emailed you. If you don't see it, check your spam/junk folder.
              </Text>

              <View style={styles.forgotPasswordForm}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={styles.forgotPasswordLockedInput}>
                  <MaterialCommunityIcons
                    name="email-check"
                    size={20}
                    color={COLORS.textMuted}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.lockedEmailText}>{verifyEmailAddress}</Text>
                </View>

                <Text style={styles.inputLabel}>Verification Code</Text>
                <View style={styles.verificationCodeRow}>
                  {Array.from({ length: VERIFICATION_CODE_LENGTH }).map((_, index) => (
                    <TextInput
                      key={`verification-digit-${index}`}
                      ref={(ref) => {
                        verificationCodeInputRefs.current[index] = ref;
                      }}
                      style={[
                        styles.verificationCodeDigitInput,
                        index !== VERIFICATION_CODE_LENGTH - 1 && styles.verificationCodeDigitInputSpacer,
                      ]}
                      value={verificationCodeDigits[index] || ''}
                      onChangeText={(text) => handleVerificationDigitChange(index, text)}
                      onKeyPress={(event) => handleVerificationDigitKeyPress(index, event)}
                      keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
                      maxLength={1}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType={index === VERIFICATION_CODE_LENGTH - 1 ? 'done' : 'next'}
                      blurOnSubmit={false}
                    />
                  ))}
                </View>

                {verifyEmailMessage ? (
                  <Text
                    style={[
                      styles.forgotPasswordMessage,
                      {
                        color: /unable|invalid|expired|error|missing|not found/i.test(
                          (verifyEmailMessage || '').toString()
                        )
                          ? COLORS.error
                          : COLORS.success,
                      },
                    ]}
                  >
                    {verifyEmailMessage}
                  </Text>
                ) : null}

                <View style={styles.verifyCodeButtonRow}>
                  <TouchableWeb
                    style={[
                      styles.submitButton,
                      styles.forgotPasswordButton,
                      styles.verifyCodeInlineButton,
                      styles.verifyCodeInlineButtonLeft,
                      verifyEmailLoading && styles.disabledButton,
                    ]}
                    onPress={handleVerifyEmailCode}
                    disabled={verifyEmailLoading}
                  >
                    <LinearGradient
                      colors={verifyEmailLoading ? ['#CCCCCC', '#CCCCCC'] : GRADIENTS.header}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.submitButtonGradient}
                    >
                      {verifyEmailLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.submitButtonText}>Verify</Text>
                      )}
                    </LinearGradient>
                  </TouchableWeb>

                  <TouchableWeb
                    style={[
                      styles.submitButton,
                      styles.forgotPasswordButton,
                      styles.verifyCodeInlineButton,
                      (verifyEmailLoading || verifyEmailResendSecondsLeft > 0) && styles.disabledButton,
                    ]}
                    onPress={handleResendVerificationCode}
                    disabled={verifyEmailLoading || verifyEmailResendSecondsLeft > 0}
                  >
                    <LinearGradient
                      colors={
                        verifyEmailLoading || verifyEmailResendSecondsLeft > 0
                          ? ['#CCCCCC', '#CCCCCC']
                          : GRADIENTS.header
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.submitButtonGradient}
                    >
                      {verifyEmailLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.submitButtonText}>
                          {verifyEmailResendSecondsLeft > 0
                            ? `Resend in ${formatVerifyEmailResendCountdown(verifyEmailResendSecondsLeft)}`
                            : 'Resend Code'}
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableWeb>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LegalModal
        visible={legalVisible}
        document={legalDoc}
        onClose={() => setLegalVisible(false)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  logoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  logo: {
    // Dimensions set inline to prevent module-time evaluation
  },
  textLogo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 48,
    fontWeight: '800',
    color: '#0066cc',
    letterSpacing: 3,
    fontFamily: 'Poppins_700Bold',
  },
  logoSubtext: {
    fontSize: 16,
    color: '#22d0cd',
    fontWeight: '600',
    marginTop: -5,
    letterSpacing: 1,
    fontFamily: 'Poppins_600SemiBold',
  },
  authKeyboardView: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  authContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 85,
  },
  staticContainer: {
    padding: 30,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  fixedAuthBox: {
    width: '100%',
    maxWidth: 450,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 30,
  },
  scrollContainerKeyboard: {
    justifyContent: 'flex-start', // When keyboard is visible, start from top instead of center
    paddingVertical: 20, // Reduce vertical padding to fit more content
    minHeight: 700, // Ensure content is tall enough to scroll
  },
  scrollContainerSignup: {
    justifyContent: 'flex-start', // Start from top for signup to accommodate more fields
    paddingVertical: 25, // Adjust padding for better spacing
    minHeight: 650, // Ensure enough height for all signup fields
  },
  authContent: {
    alignItems: 'center',
    minHeight: 400, // Content height
    width: '100%',
  },
  authContentExpanded: {
    minHeight: 580, // Increased height for signup form
    paddingBottom: 30, // Extra bottom padding for signup
  },
  authContentKeyboard: {
    minHeight: 600, // Taller content when keyboard is visible to ensure scrolling
    paddingBottom: 60, // Extra bottom padding to ensure last elements are reachable
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 25,
    marginBottom: 20,
    overflow: 'hidden',
    width: '100%',
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    borderRadius: 21,
    overflow: 'hidden',
  },
  activeToggleGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.7)',
    textAlign: 'center',
    paddingVertical: 12,
  },
  activeToggleText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  formContainer: {
    marginBottom: 20,
    width: '100%',
  },
  inputWrapper: {
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 8,
    backgroundColor: 'transparent', // Subtle faded background
  },
  inputGradientLine: {
    height: 2,
    width: '100%',
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    marginLeft: 12,
    fontSize: 16,
    color: '#000',
  },
  eyeIcon: {
    padding: 4,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    color: '#000',
  },
  rememberMeButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rememberMeText: {
    fontSize: 14,
    color: '#333',
    marginLeft: 8,
  },
  forgotPassword: {
    padding: 5,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4A90E2',
  },

  termsText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    marginTop: -10, // Reduced negative margin for better spacing
    lineHeight: 16,
    paddingHorizontal: 10, // Add horizontal padding for better text wrapping
  },
  termsLink: {
    color: '#1005efff',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(51, 51, 51, 0.3)',
  },
  dividerText: {
    marginHorizontal: 15,
    fontSize: 14,
    color: '#666',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -5, // Reduced from 10 to 5
  },
  linkText: {
    fontSize: 14,
    color: '#333',
  },
  linkButton: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1005efff',
    textDecorationLine: 'underline',
  },
  submitButton: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
    width: '100%',
  },
  submitButtonGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
  },
  disabledButton: {
    backgroundColor: '#CCCCCC',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff', // White text on gradient background
  },
  forgotPasswordOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  forgotPasswordContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    width: '90%',
    maxHeight: '80%',
    paddingHorizontal: 0,
    paddingVertical: 0,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  forgotPasswordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  forgotPasswordTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  forgotPasswordCloseButton: {
    padding: 5,
  },
  forgotPasswordContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  forgotPasswordDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  forgotPasswordForm: {
    gap: SPACING.md,
  },
  forgotPasswordInput: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    color: COLORS.text,
    fontSize: 14,
    minHeight: 48,
  },
  verificationCodeRow: {
    flexDirection: 'row',
  },
  verificationCodeDigitInput: {
    flex: 1,
    minWidth: 32,
    maxWidth: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: COLORS.inputBackground || COLORS.lightGray,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  verificationCodeDigitInputSpacer: {
    marginRight: SPACING.sm,
  },
  forgotPasswordLockedInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    minHeight: 52,
  },
  lockedEmailText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  lockedEmailHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  forgotPasswordButton: {
    marginTop: SPACING.sm,
  },
  forgotPasswordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPasswordMessage: {
    fontSize: 13,
    marginVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    fontWeight: '500',
  },
  backToEmailButton: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  backToEmailButtonText: {
    color: '#4A90E2',
    fontSize: 14,
    fontWeight: '500',
  },
  guestAccessButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.28)',
    backgroundColor: 'rgba(74, 144, 226, 0.06)',
  },
  guestAccessButtonText: {
    color: '#2C6DB8',
    fontSize: 14,
    fontWeight: '600',
  },
  verifyCodeButtonRow: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
  },
  verifyCodeInlineButton: {
    flex: 1,
    width: 'auto',
  },
  verifyCodeInlineButtonLeft: {
    marginRight: SPACING.md,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 8,
    paddingRight: SPACING.sm,
  },
  togglePasswordButton: {
    padding: SPACING.md,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  successIcon: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  emailHighlight: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A90E2',
    textAlign: 'center',
    marginVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(74, 144, 226, 0.1)',
    borderRadius: 8,
  },
});