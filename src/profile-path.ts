const profileNamePattern = /^[a-z0-9][a-z0-9_-]*$/;

export function isCanonicalProfileName(name: string): boolean {
  return profileNamePattern.test(name);
}

export function buildWebhookPath(profileName: string): string {
  if (!isCanonicalProfileName(profileName)) {
    throw new Error("Profile name must use lowercase letters, numbers, dash, or underscore");
  }
  return `/api/line/webhook/${profileName}`;
}

export function assertCanonicalWebhookPath(profileName: string, webhookPath: string): void {
  const expected = buildWebhookPath(profileName);
  if (webhookPath !== expected) {
    throw new Error(`Profile "${profileName}" webhookPath must be "${expected}"`);
  }
}
