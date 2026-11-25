const PROFILE_FIELDS = ["id", "name", "email", "image", "displayName", "phone", "preferredMarket", "postalCode", "profilePictureId"];

export function publicProfile(user) {
  if (!user || typeof user !== "object") return {};
  return Object.fromEntries(PROFILE_FIELDS.filter((key) => key in user).map((key) => [key, user[key]]));
}
