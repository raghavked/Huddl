/* Expo reads app.json, then hands the result through this file. Normally it
 * passes straight through unchanged.
 *
 * HEARTH_PERSONAL_TEAM=1 exists for cable-on-the-desk testing with a free
 * Apple ID, before any Developer Program membership. A free account's
 * Personal Team cannot sign two entitlements this app otherwise carries:
 * push notifications (aps-environment) and associated domains (the applinks
 * that open uhearth.app links in the app). With either present, the build
 * dies at signing with exactly this:
 *
 *   Cannot create a iOS App Development provisioning profile for
 *   "app.uhearth.mobile". Personal development teams ... do not support
 *   the Push Notifications capability.
 *
 * The first version of this flag only removed the sources (the
 * expo-notifications plugin and ios.associatedDomains) and a real build on a
 * real Mac still hit the error above, so the flag no longer trusts the
 * sources: a config plugin now deletes both keys from the generated
 * entitlements file itself, last in the chain, after every other plugin has
 * had its say. Belt, braces, and a proof: the entitlements assertions live
 * in the repo's checks, generated with and without the flag.
 *
 * The whole cost of a personal-team build is that campus links open in
 * Safari and push stays silent. Everything else is the real app.
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
const { withEntitlementsPlist } = require("expo/config-plugins");

/** Deletes the two personal-team-unsignable keys, whoever added them. */
const withPersonalTeamEntitlements = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults["aps-environment"];
    delete mod.modResults["com.apple.developer.associated-domains"];
    return mod;
  });

module.exports = ({ config }) => {
  if (process.env.HEARTH_PERSONAL_TEAM !== "1") return config;

  const ios = { ...(config.ios ?? {}) };
  delete ios.associatedDomains;

  const plugins = (config.plugins ?? []).filter(
    (plugin) =>
      (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-notifications"
  );
  plugins.push(withPersonalTeamEntitlements);

  return { ...config, ios, plugins };
};
