import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { setDoc, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Login လုပ်ဆောင်ချက်
window.handleLogin = async () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;

    try {
        const result = await signInWithEmailAndPassword(auth, email, pass);
        checkUserRole(result.user.uid);
    } catch (err) { alert("အီးမေးလ် သို့မဟုတ် စကားဝှက် မှားနေပါသည်"); }
};

// Role ကို စစ်ဆေးပြီး Page လွှဲပေးခြင်း
async function checkUserRole(uid) {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
        const role = userSnap.data().role;
        if (role === "delivery") {
            window.location.href = "delivery.html";
        } else {
            window.location.href = "customer.html";
        }
    }
}
