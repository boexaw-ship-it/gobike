import { db } from './firebase-config.js';
import { 
    doc, 
    updateDoc, 
    increment, 
    getDoc, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * ၁။ Rider ရဲ့ Coin နဲ့ Rating ကို Real-time စောင့်ကြည့်ခြင်း
 * HTML ထဲက id="display-coins" နဲ့ ချိတ်ဆက်ပေးမှာဖြစ်ပါတယ်
 */
export function watchRiderStats(uid, coinElementId, ratingElementId) {
    if (!uid) return;
    
    const riderRef = doc(db, "riders", uid);
    
    // onSnapshot သုံးထားလို့ Firebase မှာ Data ပြောင်းတာနဲ့ HTML မှာပါ ချက်ချင်းလိုက်ပြောင်းမယ်
    return onSnapshot(riderRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // --- Coin ပြသခြင်း ---
            if (coinElementId) {
                const coinEl = document.getElementById(coinElementId);
                if (coinEl) {
                    const coins = data.coins || 0;
                    coinEl.innerText = `${coins.toLocaleString()} Coins`;
                }
            }

            // --- Rating ပြသခြင်း ---
            if (ratingElementId) {
                const ratingEl = document.getElementById(ratingElementId);
                if (ratingEl) {
                    const totalStars = data.totalStars || 0;
                    const count = data.ratingCount || 0;
                    const avg = count === 0 ? "5.0" : (totalStars / count).toFixed(1);
                    ratingEl.innerText = `⭐ ${avg} (${count})`;
                }
            }
        }
    }, (error) => {
        console.error("Stats Watch Error:", error);
    });
}

/**
 * ၂။ Coin လုံလောက်မှု ရှိမရှိ စစ်ဆေးခြင်း
 */
export async function hasEnoughCoins(uid, requiredAmount) {
    try {
        const riderRef = doc(db, "riders", uid);
        const snap = await getDoc(riderRef);
        if (snap.exists()) {
            const currentCoins = snap.data().coins || 0;
            return currentCoins >= requiredAmount;
        }
        return false;
    } catch (error) {
        console.error("Check Balance Error:", error);
        return false;
    }
}

/**
 * ၃။ အော်ဒါအတွက် Coin နှုတ်ယူခြင်း
 */
export async function deductOrderFee(uid, amount) {
    try {
        const riderRef = doc(db, "riders", uid);
        await updateDoc(riderRef, {
            coins: increment(-amount)
        });
        return true;
    } catch (error) {
        console.error("Deduct Fee Error:", error);
        return false;
    }
}

/**
 * ၄။ Rating အသစ်ပေါင်းထည့်ခြင်း (Customer Side ကနေ သုံးရန်)
 */
export async function addRiderRating(riderId, stars) {
    try {
        const riderRef = doc(db, "riders", riderId);
        await updateDoc(riderRef, {
            totalStars: increment(stars),
            ratingCount: increment(1)
        });
        return true;
    } catch (error) {
        console.error("Add Rating Error:", error);
        return false;
    }
}

