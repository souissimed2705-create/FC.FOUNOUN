export interface FirebaseWebClientConfig {
  apiKey: string;
  messagingSenderId: string;
  appId: string;
}

/** Returns missing or malformed public Firebase Web App configuration fields. */
export function getMissingFirebaseConfigFields(config: FirebaseWebClientConfig): string[] {
  const missing: string[] = [];
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(config.apiKey)) missing.push('VITE_FIREBASE_API_KEY');
  if (!/^\d+$/.test(config.messagingSenderId)) missing.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  if (!/^1:\d+:web:[0-9a-f]+$/i.test(config.appId)) missing.push('VITE_FIREBASE_APP_ID');
  return missing;
}
