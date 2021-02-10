window.issueTooManyRequests = async function (token, reqNum = 100, path = 'users/me') {
  const url = `https://api.inindca.com/api/v2/${path}`;
  const fetchy = (_callNum) => {
    return fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    })
      .then(response => response.json())
      .then(data => {
        console.log('Success!'/* , callNum */);
      })
      .catch((e) => {
        console.error('Error X_X');
      });
  };

  const arr = [];
  for (let i = 0; i < reqNum; i++) {
    arr[i] = fetchy(i);
  }

  return Promise.all(arr);
};
