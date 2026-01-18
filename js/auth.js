import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

/**
 * ၁။ Auto Login Checker & Role Redirect
 * မြေပုံမဲနေသည့်ပြဿနာအတွက် လက်ရှိစာမျက်နှာကို စစ်ဆေးသည့် logic ထည့်သွင်းထားသည်
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User already logged in:", user.uid);
        
        // လက်ရှိရောက်နေသော URL Path ကိုရယူပါ
        const currentPath = window.location.pathname;

        try {
            // Rider Collection မှာ အရင်ရှာ
            const riderDoc = await getDoc(doc(db, "riders", user.uid));
            if (riderDoc.exists()) {
                // လက်ရှိစာမျက်နှာက delivery.html မဟုတ်မှသာ Redirect လုပ်ပါ
                if (!currentPath.includes("delivery.html")) {
                    window.location.href = "html/delivery.html";
                }
                return;
            }

            // Customer Collection မှာ ဆက်ရှာ
            const customerDoc = await getDoc(doc(db, "customers", user.uid));
            if (customerDoc.exists()) {
                // လက်ရှိစာမျက်နှာက customer.html မဟုတ်မှသာ Redirect လုပ်ပါ
                if (!currentPath.includes("customer.html")) {
                    window.location.href = "html/customer.html";
                }
            }
        } catch (error) {
            console.error("Auto Login Error:", error);
        }
    }
});

/**
 * ၂။ Signup Function
 */
async function handleSignUp() {
    const signupBtn = document.getElementById('signupBtn');
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const role = document.getElementById('reg-role').value;

    if (!name || !email || !password || !phone) {
        alert("အချက်အလက်အားလုံး ဖြည့်ပါ");
        return;
    }

    signupBtn.disabled = true;
    signupBtn.innerText = "Processing...";

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await updateProfile(user, { displayName: name });

        const collectionName = (role === "rider") ? "riders" : "customers";
        
        let userData = {
            name: name, 
            email: email, 
            phone: phone, 
            role: role, 
            uid: user.uid,
            createdAt: serverTimestamp()
        };

        if (role === "rider") {
            userData.coins = 0;
            userData.totalStars = 0;
            userData.ratingCount = 0;
            userData.isOnline = false;
            userData.lastLocation = null;
        }

        await setDoc(doc(db, collectionName, user.uid), userData);
        await notifyTelegram(`👤 User အသစ်: ${name}\nRole: ${role}\nPhone: ${phone}`);

        alert("Account ဖွင့်လှစ်ပြီးပါပြီ။ Dashboard သို့ ပို့ဆောင်ပေးနေပါသည်...");
        window.location.href = (role === "customer") ? "html/customer.html" : "html/delivery.html";

    } catch (error) {
        alert("Error: " + error.message);
        signupBtn.disabled = false;
        signupBtn.innerText = "Create Account";
    }
}

/**
 * ၃။ Login Function
 */
async function handleLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const rememberMe = document.getElementById('remember-checkbox').checked;

    if (!email || !password) {
        alert("Email နှင့် Password ဖြည့်ပါ");
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerText = "Signing In...";

    try {
        const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistenceType);

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        let userDoc = await getDoc(doc(db, "riders", user.uid));
        if (userDoc.exists()) {
            window.location.href = "html/delivery.html";
            return;
        }

        userDoc = await getDoc(doc(db, "customers", user.uid));
        if (userDoc.exists()) {
            window.location.href = "html/customer.html";
        } else {
            alert("အကောင့်အချက်အလက် ရှာမတွေ့ပါ။");
            loginBtn.disabled = false;
            loginBtn.innerText = "Sign In";
        }

    } catch (error) {
        alert("Login မှားယွင်းနေပါသည်။");
        loginBtn.disabled = false;
        loginBtn.innerText = "Sign In";
    }
}

/**
 * ၄။ Event Listeners
 */
document.addEventListener('DOMContentLoaded', () => {
    const signupBtn = document.getElementById('signupBtn');
    const loginBtn = document.getElementById('loginBtn');
    
    if(signupBtn) signupBtn.addEventListener('click', handleSignUp);
    if(loginBtn) loginBtn.addEventListener('click', handleLogin);
});
