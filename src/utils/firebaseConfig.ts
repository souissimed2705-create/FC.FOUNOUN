export interface FirebaseWebConfigValidationInput {
  apiKey: string;
  messagingSenderId: string;
  appId: string;
}

/**
 * Validate the public Firebase Web configuration without initializing Firebase.
 * Keep this pure so the exact production checks can be covered by unit tests.
 */
export function getMissingFirebaseConfig(
  config: FirebaseWebConfigValidationInput,
): string[] {
  const missing: string[] = [];
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(config.apiKey)) {
    missing.push('VITE_FIREBASE_API_KEY');
  }
  if (!/^\d+$/.test(config.messagingSenderId)) {
    missing.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  }
  if (!/^1:\d+:web:[0-9a-f]+$/i.test(config.appId)) {
    missing.push('VITE_FIREBASE_APP_ID');
  }
  return missing;
}
