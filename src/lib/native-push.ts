/** Push registration runs only for a signed-in staff session in an APK that includes Firebase. */
export function canRegisterStaffPush(firebaseConfigured: boolean, hasSession: boolean): boolean {
  return firebaseConfigured && hasSession;
}
