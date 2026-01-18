import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

/**
 * ၁။ Auto Login Checker
 * စာမျက်နှာစဖွင့်တာနဲ့ User က Login ဝင်ထားပြီးသားလားဆိုတာကို စစ်ဆေးပေးပါတယ်။
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User already logged in:", user.uid);
        
        // ဘယ် Role လဲဆိုတာ စစ်ဆေးပြီး သက်ဆိုင်ရာ Dashboard ကို ပို့ပေးမယ်
        try {
            // Rider ဟုတ်မဟုတ် အရင်စစ်
            const riderDoc = await getDoc(doc(db, "riders", user.uid));
            if (riderDoc.exists()) {
                window.location.href = "html/delivery.html";
                return;
            }

            // Customer ဟုတ်မဟုတ် ထပ်စစ်
            const customerDoc = await getDoc(doc(db, "customers", user.uid));
            if (customerDoc.exists()) {
                window.location.href = "html/customer.html";
            }
        } catch (error) {
            console.error("Auto Login Error:", error);
        }
    } else {
        console.log("No user logged in. Stay on login page.");
    }
});

// Signup Function
async function handleSignUp() {
    const signupBtn = document.getElementById('signupBtn');
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const role = document.getElementById('reg-role').value; // 'customer' သို့မဟုတ် 'rider'

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
            userData.rating = 5.0;
            userData.ratingSum = 0;
            userData.reviewCount = 0;
            userData.status = "online";
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

// Login Function
async function handleLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!email || !password) {
        alert("Email နှင့် Password ဖြည့်ပါ");
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerText = "Signing In...";

    try {
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
        alert("Login မှားယွင်းနေပါသည်။ (Password သို့မဟုတ် Email မှားနိုင်သည်)");
        loginBtn.disabled = false;
        loginBtn.innerText = "Sign In";
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const signupBtn = document.getElementById('signupBtn');
    const loginBtn = document.getElementById('loginBtn');
    
    if(signupBtn) signupBtn.addEventListener('click', handleSignUp);
    if(loginBtn) loginBtn.addEventListener('click', handleLogin);
});
