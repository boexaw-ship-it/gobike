const firebaseConfig = {
  apiKey: "AIzaSyA1tAW0DWW633uYOZ1cHw-kfnHL2kQrlNM",
  authDomain: "gobike-14050.firebaseapp.com",
  projectId: "gobike-14050",
  storageBucket: "gobike-14050.appspot.com",
  messagingSenderId: "1079730742000",
  appId: "1:1079730742000:web:2ba453b89870404fcc1835"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
