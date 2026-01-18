import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

/**
 * ၁။ Auto Login Checker
 * စာမျက်နှာဖွင့်တာနဲ့ User က ရှိပြီးသားဆိုရင် Dashboard ကို တန်းပို့ပေးမယ်
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User detected:", user.uid);
        try {
            // Rider ဟုတ်မဟုတ် အရင်စစ်
            const riderDoc = await getDoc(doc(db, "riders", user.uid));
            if (riderDoc.exists()) {
                // Rider ဖြစ်ရင် Online Status ကိုပါ တစ်ခါတည်း True ပေးခဲ့မယ်
                await updateDoc(doc(db, "riders", user.uid), { isOnline: true });
                window.location.href = "html/delivery.html";
                return;
            }

            // Customer ဟုတ်မဟုတ် စစ်
            const customerDoc = await getDoc(doc(db, "customers", user.uid));
            if (customerDoc.exists()) {
                window.location.href = "html/customer.html";
            }
        } catch (error) {
            console.error("Auto Login Error:", error);
        }
    }
});

// Signup Function
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

        // Rider အတွက် လိုအပ်သော status များ ထည့်သွင်းခြင်း
        if (role === "rider") {
            userData.rating = 5.0;
            userData.ratingSum = 0;
            userData.reviewCount = 0;
            userData.isOnline = true; // Dashboard ရောက်ရင် မြေပုံပေါ်တန်းပေါ်စေရန်
            userData.status = "online";
        }

        await setDoc(doc(db, collectionName, user.uid), userData);
        await notifyTelegram(`👤 User အသစ်: ${name}\nRole: ${role}\nPhone: ${phone}`);

        alert("အကောင့်ဖွင့်ခြင်း အောင်မြင်ပါသည်။");
        window.location.href = (role === "rider") ? "html/delivery.html" : "html/customer.html";

    } catch (error) {
        alert("Signup Error: " + error.message);
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

        // Rider စစ်ဆေးခြင်း
        const riderDoc = await getDoc(doc(db, "riders", user.uid));
        if (riderDoc.exists()) {
            // Login ဝင်တာနဲ့ Online ဖြစ်သွားအောင် Update လုပ်မယ်
            await updateDoc(doc(db, "riders", user.uid), { isOnline: true });
            window.location.href = "html/delivery.html";
            return;
        }

        // Customer စစ်ဆေးခြင်း
        const customerDoc = await getDoc(doc(db, "customers", user.uid));
        if (customerDoc.exists()) {
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
