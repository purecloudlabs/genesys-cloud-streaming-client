module.exports = {
  sourceType: 'unambiguous',
  presets: [
    ['@babel/preset-env',
      {
        useBuiltIns: 'usage',
        corejs: { version: '3', proposals: true },
        debug: false, /* set to `true` if you start banging your head against the wall */
        targets: [
          'last 2 versions',
          '> 5%',
          'IE 11',
          'not dead'
        ]
      }
    ]
  ],
  plugins: []
};
