/**
 * The Firebase web identifiers the browser needs to start Google sign-in. Every value is public by
 * design (they ship to each visitor; Firebase guards data with rules and authorized domains, not by
 * hiding them), so the server may hand this object to a client component as a prop.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
}
