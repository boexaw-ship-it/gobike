// Auto anonymous login
firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    firebase.auth().signInAnonymously()
      .catch(err => alert(err.message));
  } else {
    console.log("Logged in UID:", user.uid);
    window.currentUID = user.uid;
  }
});
