# Firebase Migration Guide for 876Nurses App

## Overview
This guide walks you through migrating the app from MongoDB/API-based authentication to Firebase (Authentication + Firestore).

## Step 1: Install Firebase Packages

Run the following command to install Firebase dependencies:

```bash
npm install firebase
```

If you're using Expo, also install the Firebase adapter:

```bash
npx expo install expo-constants
```

## Step 2: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a new project"
3. Name it "876nurses-firebase"
4. Enable Google Analytics (optional)
5. Create the project

## Step 3: Get Firebase Credentials

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Click **Your apps** section
3. Click **Web** (or create a new web app)
4. Copy the Firebase config object

## Step 4: Update Firebase Configuration

Update the file `config/firebase.js` with your credentials:

```javascript
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID'
};
```

## Step 5: Set Up Firestore Database

1. In Firebase Console, go to **Firestore Database**
2. Click **Create database**
3. Choose region closest to your users (Jamaica: `us-south1`)
4. Start in **Test Mode** (for development only)
5. Click **Enable**

## Step 6: Set Up Authentication

1. In Firebase Console, go to **Authentication**
2. Click **Get Started**
3. Enable **Email/Password** provider
4. Optionally enable:
   - Google Sign-In
   - Phone Authentication
   - Social providers

### Step 6b: Email Verification (6-digit code, no links)

This app enforces email verification before allowing sign-in.
To avoid Firebase-hosted verification links/domains, it uses an in-app **6-digit verification code**:

- Cloud Function `requestEmailVerificationCode` emails a 6-digit code.
- Cloud Function `verifyEmailVerificationCode` validates the code and sets `emailVerified=true` on the Firebase Auth user server-side.

Setup requirements:

1. Ensure the email service is configured (see `EMAIL_SERVICE_SETUP.md`).
2. Deploy Cloud Functions:

```bash
firebase deploy --only functions
```

Notes:
- No Firebase Hosting custom domain or DNS changes are required for this verification approach.
- The code records are stored server-side in Firestore (`emailVerificationCodes/{uid}`) and are not meant to be accessed directly by the client.

## Step 7: Create Firestore Security Rules

In Firestore **Rules** tab, add these rules for development:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth.uid == userId;
      allow write: if request.auth.uid == userId;
      allow read: if hasRole('admin') && userId != request.auth.uid;
    }
    
    // Appointments collection
    match /appointments/{appointmentId} {
      allow read: if request.auth.uid == resource.data.userId;
      allow create: if request.auth.uid == request.resource.data.userId;
      allow update: if request.auth.uid == resource.data.userId;
      allow delete: if request.auth.uid == resource.data.userId;
    }
    
    // Invoices collection
    match /invoices/{invoiceId} {
      allow read: if request.auth.uid == resource.data.userId;
      allow create: if request.auth.uid == request.resource.data.userId;
      allow update: if request.auth.uid == resource.data.userId;
      allow delete: if request.auth.uid == resource.data.userId;
    }
    
    // Shift Requests collection
    match /shiftRequests/{shiftId} {
      allow read: if request.auth.uid == resource.data.userId;
      allow create: if request.auth.uid == request.resource.data.userId;
      allow update: if request.auth.uid == resource.data.userId;
    }
    
    // Payslips collection
    match /payslips/{payslipId} {
      allow read: if request.auth.uid == resource.data.userId;
    }
    
    // Helper function
    function hasRole(role) {
      return request.auth.uid != null && 
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == role;
    }
  }
}
```

## Step 8: Migrate Authentication Context

Replace the old `context/AuthContext.js` with the new Firebase version:

```bash
# Backup the old file
mv context/AuthContext.js context/AuthContext.old.js

# Rename the Firebase version to the standard name
mv context/AuthContext-Firebase.js context/AuthContext.js
```

## Step 9: Update Package.json Firebase Config (Optional)

Add this to your `app.json` for Expo:

```json
{
  "expo": {
    "extra": {
      "firebase": {
        "projectId": "876nurses-firebase",
        "apiKey": "YOUR_API_KEY"
      }
    }
  }
}
```

## Step 10: Update SplashScreen Auth Calls

The authentication now uses email instead of username. Update `screens/SplashScreen.js`:

Change login parameters from:
```javascript
const { login, signup } = useAuth();
// Old: handleLogin(username, password)
// New: handleLogin(email, password)
```

## Step 11: Data Migration (Optional)

If you have existing MongoDB data, you can migrate it to Firestore:

1. Export MongoDB data as JSON
2. Use the `FirebaseService` batch operations to import:

```javascript
const importMongoDB = async (mongoData) => {
  const operations = mongoData.users.map(user => ({
    collection: 'users',
    docId: user._id, // Use MongoDB ID
    data: {
      email: user.email,
      username: user.username,
      phone: user.phone,
      role: user.role,
      // ... other fields
    }
  }));
  
  await FirebaseService.batchCreate(operations);
};
```

## Step 12: Test the Authentication

1. Start the app: `npm start`
2. Try signing up with an email
3. Try logging in with that email
4. Check Firebase Console > Firestore to see the created documents

## Firestore Collections Schema

### users
```
{
  id: string (Firebase UID),
  email: string,
  username: string,
  displayName: string,
  phone: string,
  address: string,
  country: string,
  role: 'patient' | 'nurse' | 'admin' | 'superAdmin',
  fcmToken: string (optional),
  profileImageUrl: string (optional),
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### appointments
```
{
  id: string,
  userId: string,
  nurseId: string,
  appointmentDate: string,
  appointmentTime: string,
  service: string,
  status: 'scheduled' | 'completed' | 'cancelled',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### invoices
```
{
  id: string,
  userId: string,
  invoiceNumber: string,
  amount: number,
  tax: number,
  total: number,
  status: 'pending' | 'paid' | 'cancelled',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### shiftRequests
```
{
  id: string,
  userId: string,
  shiftDate: string,
  shift: string,
  status: 'pending' | 'accepted' | 'rejected',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### payslips
```
{
  id: string,
  userId: string,
  month: string,
  year: string,
  amount: number,
  status: 'pending' | 'processed',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Troubleshooting

### "Module not found: firebase"
```bash
npm install firebase
```

### "Auth/Project not configured"
- Check your Firebase credentials in `config/firebase.js`
- Ensure Firebase project exists and is enabled

### Firestore permissions denied
- Update Firestore Rules (see Step 7)
- Make sure user is authenticated before accessing Firestore

### Development vs Production
- Use different Firebase projects for development and production
- Switch configs using environment variables:

```javascript
const config = __DEV__ 
  ? firebaseConfigDev 
  : firebaseConfigProd;
```

## Next Steps

1. ✅ Install Firebase
2. ✅ Set up Firebase project and credentials
3. ✅ Create Firestore database
4. ✅ Configure authentication
5. ✅ Set up security rules
6. ✅ Update AuthContext
7. ✅ Test authentication
8. ✅ Migrate data from MongoDB (if needed)

Your app is now ready to use Firebase!
