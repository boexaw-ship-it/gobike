import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// Signup Function
async function handleSignUp() {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value;
    const role = document.getElementById('reg-role').value;

    if (!name || !email || !password || !phone) {
        alert("အချက်အလက်အားလုံး ဖြည့်ပါ");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Firestore ထဲ သိမ်းမယ်
        await setDoc(doc(db, "users", user.uid), {
            name, email, phone, role, uid: user.uid
        });

        // Telegram ပို့မယ်
        await notifyTelegram(`👤 User အသစ်: ${name}\nRole: ${role}\nPhone: ${phone}`);

        alert("Account ဖွင့်လှစ်ပြီးပါပြီ");
        window.location.href = (role === "customer") ? "html/customer.html" : "html/delivery.html";

    } catch (error) {
        alert("Error: " + error.message);
    }
}

// Login Function
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const role = userDoc.data().role;
            window.location.href = (role === "customer") ? "html/customer.html" : "html/delivery.html";
        }
    } catch (error) {
        alert("Login မှားယွင်းနေပါသည်");
    }
}

// ခလုတ်နှိပ်ခြင်းကို နားထောင်ခြင်း (ဒါမှ ခလုတ်နှိပ်ရင် အလုပ်လုပ်မှာပါ)
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('signupBtn').addEventListener('click', handleSignUp);
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
});
