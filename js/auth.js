import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- Signup Logic ---
async function handleSignUp() {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value;
    const role = document.getElementById('reg-role').value;

    if (!name || !email || !password || !phone) {
        alert("အချက်အလက်အားလုံး ဖြည့်စွက်ပေးပါ");
        return;
    }

    try {
        // 1. Firebase Auth မှာ User ဆောက်မယ်
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Firestore ရဲ့ "users" collection ထဲမှာ အချက်အလက် သိမ်းမယ်
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            name: name,
            email: email,
            phone: phone,
            role: role, // customer သို့မဟုတ် delivery
            createdAt: new Date()
        });

        // 3. Telegram ဆီကို Notification လှမ်းပို့မယ်
        const msg = `👤 <b>Account အသစ်ဖွင့်လှစ်မှု!</b>\n\n` +
                    `အမည်: ${name}\n` +
                    `ကဏ္ဍ: ${role}\n` +
                    `ဖုန်း: ${phone}\n` +
                    `Gmail: ${email}`;
        
        await notifyTelegram(msg);

        alert("Account ဖွင့်ခြင်း အောင်မြင်ပါသည်။");
        redirectUser(role);

    } catch (error) {
        console.error(error);
        alert("Register လုပ်ရာတွင် အမှားရှိနေပါသည်: " + error.message);
    }
}

// --- Login Logic ---
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert("Email နှင့် Password ဖြည့်ပါ");
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Firestore ကနေ User ရဲ့ Role ကို ပြန်စစ်မယ်
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            redirectUser(userData.role);
        } else {
            alert("User data မတွေ့ရှိပါ။");
        }
    } catch (error) {
        alert("Gmail သို့မဟုတ် Password မှားနေပါသည်");
    }
}

// Role အလိုက် Page လမ်းကြောင်း ခွဲပို့ခြင်း
function redirectUser(role) {
    if (role === "customer") {
        window.location.href = "html/customer.html";
    } else if (role === "delivery") {
        window.location.href = "html/delivery.html";
    }
}

// HTML ထဲက Button ID များဖြင့် ချိတ်ဆက်ခြင်း
document.getElementById('signupBtn')?.addEventListener('click', handleSignUp);
document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
