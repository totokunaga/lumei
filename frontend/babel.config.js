module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Bundles drizzle/*.sql migrations into the app as strings (src/db/client.ts).
    plugins: [['inline-import', { extensions: ['.sql'] }]],
    env: {
      // Jest can't run `import()` without experimental VM modules, so tests
      // turn it into `require`. Metro bundles `import()` itself.
      test: { plugins: ['@babel/plugin-transform-dynamic-import'] },
    },
  };
};
