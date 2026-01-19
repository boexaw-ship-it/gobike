import { db, auth } from './firebase-config.js';
import { 
    doc, 
    updateDoc, 
    onSnapshot, 
    runTransaction, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * ၁။ Rider Profile ကို Real-time စောင့်ကြည့်ခြင်း
 * Coin အရေအတွက်ပြောင်းလဲမှုနဲ့ Online Status ကို UI မှာ ချက်ချင်းပြဖို့
 */
export function initRiderSync() {
    const user = auth.currentUser;
    if (!user) return;

    const riderRef = doc(db, "riders", user.uid);
    onSnapshot(riderRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            
            // Coin ပြခြင်း
            const coinDisplay = document.getElementById('rider-coins');
            if (coinDisplay) coinDisplay.innerText = data.coins || 0;

            // Switch အခြေအနေပြခြင်း
            const toggle = document.getElementById('online-toggle');
            const label = document.getElementById('status-label');
            if (toggle) {
                toggle.checked = data.isOnline || false;
                if (label) {
                    label.innerText = data.isOnline ? "Online" : "Offline";
                    data.isOnline ? label.classList.add('online') : label.classList.remove('online');
                }
            }
        }
    });
}

/**
 * ၂။ Online/Offline Toggle Function
 * Map ပေါ်မှာ ပေါ်/မပေါ် status ကို ထိန်းချုပ်သည်
 */
window.toggleOnlineStatus = async (checkbox) => {
    const user = auth.currentUser;
    if (!user) return;

    const riderRef = doc(db, "riders", user.uid);
    try {
        await updateDoc(riderRef, {
            isOnline: checkbox.checked,
            lastSeen: serverTimestamp()
        });
    } catch (error) {
        console.error("Status Update Error:", error);
        checkbox.checked = !checkbox.checked; // Error တက်ရင် switch ပြန်ဖြုတ်မယ်
    }
};

/**
 * ၃၊ ၄၊ ၅။ Secure Order Acceptance Logic
 * Coin စစ်ဆေးခြင်း၊ ၁၀% နှုတ်ခြင်း နှင့် တစ်ယောက်ပဲရအောင်ထိန်းချုပ်ခြင်း
 */
window.secureAcceptOrder = async (orderId, deliveryFee) => {
    const user = auth.currentUser;
    if (!user) return;

    const orderRef = doc(db, "orders", orderId);
    const riderRef = doc(db, "riders", user.uid);

    try {
        const result = await runTransaction(db, async (transaction) => {
            const orderSnap = await transaction.get(orderRef);
            const riderSnap = await transaction.get(riderRef);

            if (!orderSnap.exists()) throw "အော်ဒါရှာမတွေ့ပါ။";
            if (orderSnap.data().status !== "pending") throw "ဤအော်ဒါကို တခြားသူယူသွားပါပြီ။";

            const currentCoins = riderSnap.data().coins || 0;

            // အချက် (၂) - Coin ၅၀ အနည်းဆုံးရှိမှ လက်ခံခွင့်ပြုမယ်
            if (currentCoins < 50) {
                throw "Coin အနည်းဆုံး ၅၀ ရှိမှ လက်ခံနိုင်ပါမည်။ ကျေးဇူးပြု၍ ငွေဖြည့်ပါ။";
            }

            // အချက် (၃) - 1 coin = 100 kyats (10% နှုတ်မယ်)
            // ဥပမာ - Fee က ၁၀၀၀ ဆိုရင် ၁၀% က ၁၀၀ ဖြစ်တဲ့အတွက် 1 coin နှုတ်ပါမယ်
            const deductionCoins = Math.floor((deliveryFee * 0.1) / 100);
            const finalDeduction = deductionCoins < 1 ? 1 : deductionCoins; // အနည်းဆုံး 1 coin နှုတ်မယ်

            if (currentCoins < finalDeduction) {
                throw "အော်ဒါလက်ခံရန် Coin မလုံလောက်ပါ။";
            }

            // အချက် (၄) - Transaction ဖြစ်တဲ့အတွက် တစ်ယောက်ပဲ Update လုပ်နိုင်မယ်
            transaction.update(riderRef, { 
                coins: currentCoins - finalDeduction 
            });

            transaction.update(orderRef, {
                status: "accepted",
                riderId: user.uid,
                riderName: user.displayName || "Rider",
                acceptedAt: serverTimestamp()
            });

            return "Success";
        });

        Swal.fire("အောင်မြင်ပါသည်", "အော်ဒါလက်ခံပြီးပါပြီ", "success");
    } catch (error) {
        Swal.fire("မအောင်မြင်ပါ", error, "error");
    }
};
