import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { setDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function handleSignUp() {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const phone = document.getElementById('reg-phone').value;
    const role = document.getElementById('reg-role').value;

    try {
        // 1. Firebase Auth မှာ အကောင့်ဖွင့်ခြင်း
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Firestore ထဲမှာ User Profile သိမ်းခြင်း (Role ခွဲခြားခြင်း)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: name,
            email: email,
            phone: phone,
            role: role, // 'customer' or 'delivery'
            createdAt: new Date()
        });

        alert("Register အောင်မြင်ပါသည်!");
        redirectUser(role); // Page ရွှေ့ရန်

    } catch (error) {
        console.error("Error signing up:", error.message);
        alert(error.message);
    }
}
