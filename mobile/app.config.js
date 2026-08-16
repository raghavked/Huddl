/* Expo reads app.json, then hands the result through this file. Normally it
 * passes straight through unchanged.
 *
 * HEARTH_PERSONAL_TEAM=1 exists for cable-on-the-desk testing with a free
 * Apple ID, before any Developer Program membership. A free account's
 * Personal Team cannot sign two entitlements this app otherwise carries:
 * associated domains (the applinks that open uhearth.app links in the app)
 * and push notifications (added by the expo-notifications plugin). With
 * either present, the build dies at signing with a provisioning-profile
 * error. This flag strips exactly those two, so the whole cost of the free
 * route is that campus links open in Safari and push stays silent. Every
 * other part of the app is the real app.
 *
 * The flag must be set for BOTH the prebuild and the run, because each reads
 * the config for itself:
 *
 *   HEARTH_PERSONAL_TEAM=1 npm run prebuild
 *   HEARTH_PERSONAL_TEAM=1 npm run device
 *
 * Never set it for a TestFlight or App Store build. A paid membership signs
 * both entitlements, and stripping them there would ship a build with dead
 * deep links and no notifications.
 */
module.exports = ({ config }) => {
  if (process.env.HEARTH_PERSONAL_TEAM !== "1") return config;

  const ios = { ...(config.ios ?? {}) };
  delete ios.associatedDomains;

  return {
    ...config,
    ios,
    plugins: (config.plugins ?? []).filter(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-notifications"
    ),
  };
};
