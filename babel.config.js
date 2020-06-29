module.exports = {
  sourceType: 'unambiguous',
  presets: [
    ['@babel/preset-env',
      {
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
  plugins: [
    ['@babel/plugin-transform-runtime', {
      corejs: 3
    }]
  ]
};
