import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// Signup Function
async function handleSignUp() {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value;
    const role = document.getElementById('reg-role').value; // 'customer' သို့မဟုတ် 'rider'

    if (!name || !email || !password || !phone) {
        alert("အချက်အလက်အားလုံး ဖြည့်ပါ");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // (၁) Firebase Auth Profile ထဲမှာ နာမည် သတ်မှတ်ခြင်း
        await updateProfile(user, { displayName: name });

        // (၂) ဘယ် Collection ထဲ သိမ်းမလဲဆိုတာ Role အပေါ်မူတည်ပြီး ခွဲခြားခြင်း
        const collectionName = (role === "rider") ? "riders" : "customers";
        
        // အခြေခံ သိမ်းမည့် Data
        let userData = {
            name: name, 
            email: email, 
            phone: phone, 
            role: role, 
            uid: user.uid,
            createdAt: serverTimestamp()
        };

        // (၃) အကယ်၍ Rider ဖြစ်ပါက Rating ဆိုင်ရာ Field များ ထည့်သွင်းခြင်း
        if (role === "rider") {
            userData.rating = 5.0;      // အသစ်မို့လို့ အခြေခံ ၅ ပွင့် ပေးထားမယ်
            userData.ratingSum = 0;     // စုစုပေါင်းရရှိတဲ့ ကြယ်ပွင့်
            userData.reviewCount = 0;   // Rating ပေးသူ အရေအတွက်
            userData.status = "online"; // အော်ဒါတွေ တန်းမြင်ရအောင်
        }

        // Firestore ထဲ သက်ဆိုင်ရာ Collection အလိုက် သိမ်းဆည်းခြင်း
        await setDoc(doc(db, collectionName, user.uid), userData);

        // Telegram ပို့မယ်
        await notifyTelegram(`👤 User အသစ်: ${name}\nRole: ${role}\nPhone: ${phone}`);

        alert("Account ဖွင့်လှစ်ပြီးပါပြီ");
        
        // Dashboard ဆီသို့ ပို့ဆောင်ခြင်း
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

        // အဆင့်ဆင့် စစ်ဆေးခြင်း - Rider ဖြစ်နိုင်သလား အရင်ကြည့်မယ်
        let userDoc = await getDoc(doc(db, "riders", user.uid));
        
        if (userDoc.exists()) {
            window.location.href = "html/delivery.html";
            return;
        }

        // Rider မဟုတ်ရင် Customer ထဲမှာ ထပ်ရှာမယ်
        userDoc = await getDoc(doc(db, "customers", user.uid));
        if (userDoc.exists()) {
            window.location.href = "html/customer.html";
        } else {
            alert("အကောင့်အချက်အလက်ကို Database တွင် ရှာမတွေ့ပါ။");
        }

    } catch (error) {
        console.error(error);
        alert("Login မှားယွင်းနေပါသည် သို့မဟုတ် အကောင့်မရှိပါ။");
    }
}

// ခလုတ်နှိပ်ခြင်းကို နားထောင်ခြင်း
document.addEventListener('DOMContentLoaded', () => {
    const signupBtn = document.getElementById('signupBtn');
    const loginBtn = document.getElementById('loginBtn');
    
    if(signupBtn) signupBtn.addEventListener('click', handleSignUp);
    if(loginBtn) loginBtn.addEventListener('click', handleLogin);
});
