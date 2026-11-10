// Minimum password length. The API enforces the same number in
// services/api/auth/user_manager.py (MIN_PASSWORD_LENGTH), keep them equal.
// This copy only gives the user the message before a round trip.
export const MIN_PASSWORD_LENGTH = 15;

export const PASSWORD_HINT = `Must be at least ${MIN_PASSWORD_LENGTH} characters`;
export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
