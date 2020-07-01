module.exports = (api) => {
  console.log('Babel is running mode:', api.env());

  return {
    sourceType: 'unambiguous',
    ignore: [/\/core-js/],
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
        /* if we are testing, we don't want core-js polyfills */
        corejs: api.env() === 'test' ? false : 3
      }]
    ]
  };
};
