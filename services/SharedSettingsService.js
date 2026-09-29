import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const LOCAL_KEYS = {
  general: 'adminPaymentGeneralSettings',
  payroll: 'adminPayrollSettings',
  company: 'companyDetails',
  paymentInfo: 'paymentInfo',
};

const readLocal = async (key) => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const read = async (name) => {
  const localKey = LOCAL_KEYS[name];
  if (!localKey) throw new Error(`Unknown shared setting: ${name}`);
  const ref = doc(db, 'paymentSettings', name);

  try {
    const snapshot = await getDoc(ref);
    if (snapshot.exists()) {
      const { updatedAt, ...value } = snapshot.data();
      await AsyncStorage.setItem(localKey, JSON.stringify(value));
      return value;
    }
  } catch (error) {
    console.warn(`Unable to load shared ${name} settings:`, error?.message || error);
  }

  const local = await readLocal(localKey);
  if (local) {
    try {
      await setDoc(ref, { ...local, updatedAt: serverTimestamp() });
    } catch {
      // Only administrators can migrate shared settings; other roles use the cache.
    }
  }
  return local;
};

const save = async (name, value) => {
  const localKey = LOCAL_KEYS[name];
  if (!localKey) throw new Error(`Unknown shared setting: ${name}`);
  await setDoc(doc(db, 'paymentSettings', name), { ...value, updatedAt: serverTimestamp() });
  await AsyncStorage.setItem(localKey, JSON.stringify(value));
  return value;
};

export default { read, save };
