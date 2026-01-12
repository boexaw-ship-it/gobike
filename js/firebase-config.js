import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA1tAW0DWW633uYOZ1cHw-kfnHL2kQrlNM",
  authDomain: "gobike-14050.firebaseapp.com",
  projectId: "gobike-14050",
  storageBucket: "gobike-14050.appspot.com",
  messagingSenderId: "1079730742000",
  appId: "1:1079730742000:web:2ba453b89870404fcc1835"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
