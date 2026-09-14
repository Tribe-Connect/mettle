module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved worklets into their own package; the plugin MUST be last.
    plugins: ['react-native-worklets/plugin'],
  };
};
